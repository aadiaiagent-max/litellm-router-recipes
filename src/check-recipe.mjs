import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED_TOP_LEVEL = new Set([
  "model_list",
  "router_settings",
  "litellm_settings",
  "general_settings",
]);

function stripComment(input) {
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote && input[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || input[i - 1] === " ")) {
      return input.slice(0, i).trimEnd();
    }
  }
  return input.trimEnd();
}

function parseScalar(raw) {
  const value = stripComment(raw).trim();
  if (value === "" || value === "~" || value === "null" || value === "Null") return null;
  if (value === "true" || value === "True") return true;
  if (value === "false" || value === "False") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    throw new Error("flow collections are not supported; use block YAML");
  }
  return value;
}

function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":") {
      const key = text.slice(0, i).trim();
      if (!key) throw new Error("empty key");
      return { key, rest: text.slice(i + 1).trim() };
    }
  }
  throw new Error(`expected a key, got: ${text}`);
}

function tokenize(text) {
  const lines = [];
  const rows = text.replace(/\r\n/g, "\n").split("\n");
  for (let n = 0; n < rows.length; n++) {
    const raw = rows[n];
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    if (raw.includes("\t")) throw new Error(`tabs are not allowed (line ${n + 1})`);
    const indent = raw.match(/^ */)[0].length;
    if (indent % 2 !== 0) throw new Error(`indent must be a multiple of 2 (line ${n + 1})`);
    lines.push({ indent, text: raw.trim(), line: n + 1 });
  }
  return lines;
}

export function parseYaml(text) {
  if (typeof text !== "string") throw new TypeError("parseYaml expects a string");
  const lines = tokenize(text);
  let i = 0;

  function peek() {
    return lines[i];
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const line = peek();
      if (line.indent < indent) break;
      if (line.indent !== indent) {
        throw new Error(`unexpected indent on line ${line.line}`);
      }
      if (line.text.startsWith("- ")) {
        throw new Error(`expected a key on line ${line.line}`);
      }
      const { key, rest } = splitKey(line.text);
      i++;
      obj[key] = readValue(rest, indent, line.line);
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length) {
      const line = peek();
      if (line.indent < indent) break;
      if (line.indent !== indent) {
        throw new Error(`unexpected indent on line ${line.line}`);
      }
      if (!line.text.startsWith("- ")) {
        throw new Error(`expected a list item on line ${line.line}`);
      }
      const rest = line.text.slice(2).trim();
      i++;
      if (rest === "" || rest.startsWith("#")) {
        arr.push(readNested(indent, line.line));
        continue;
      }
      if (looksLikeKey(rest)) {
        const { key, rest: after } = splitKey(rest);
        const obj = {};
        obj[key] = readValue(after, indent, line.line);
        const next = peek();
        if (next && next.indent > indent && !next.text.startsWith("- ")) {
          Object.assign(obj, parseMap(next.indent));
        }
        arr.push(obj);
        continue;
      }
      arr.push(parseScalar(rest));
    }
    return arr;
  }

  function readNested(parentIndent, lineNo) {
    const next = peek();
    if (!next || next.indent <= parentIndent) return null;
    if (next.text.startsWith("- ")) return parseList(next.indent);
    return parseMap(next.indent);
  }

  function readValue(rest, parentIndent, lineNo) {
    const cleaned = stripComment(rest).trim();
    if (cleaned !== "") return parseScalar(cleaned);
    return readNested(parentIndent, lineNo);
  }

  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) throw new Error("root keys must start at column 0");
  if (lines[0].text.startsWith("- ")) throw new Error("root must be a mapping");
  return parseMap(0);
}

function looksLikeKey(text) {
  if (text.startsWith('"') || text.startsWith("'")) return false;
  return text.includes(":");
}

export function checkRecipe(doc) {
  const errors = [];
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["root must be a mapping"] };
  }
  for (const key of Object.keys(doc)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) errors.push(`unknown top-level key: ${key}`);
  }
  if (!Object.prototype.hasOwnProperty.call(doc, "model_list")) {
    errors.push("missing model_list");
  } else if (!Array.isArray(doc.model_list) || doc.model_list.length === 0) {
    errors.push("model_list must be a non-empty list");
  } else {
    doc.model_list.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`model_list[${index}] must be a mapping`);
        return;
      }
      if (typeof entry.model_name !== "string" || entry.model_name.length === 0) {
        errors.push(`model_list[${index}] missing model_name`);
      }
      const params = entry.litellm_params;
      if (params === null || typeof params !== "object" || Array.isArray(params)) {
        errors.push(`model_list[${index}] missing litellm_params`);
      } else if (typeof params.model !== "string" || params.model.length === 0) {
        errors.push(`model_list[${index}] missing litellm_params.model`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node src/check-recipe.mjs <file.yaml>...");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    let doc;
    try {
      doc = parseYaml(readFileSync(file, "utf8"));
    } catch (err) {
      failed = true;
      console.error(`${file}: ${err.message}`);
      continue;
    }
    const result = checkRecipe(doc);
    if (!result.ok) {
      failed = true;
      for (const error of result.errors) console.error(`${file}: ${error}`);
    } else {
      console.log(`${file}: ok`);
    }
  }
  process.exit(failed ? 1 : 0);
}
