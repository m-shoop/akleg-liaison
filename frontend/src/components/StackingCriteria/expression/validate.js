import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";

export function validate(input, criteria) {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ast: null, errors: [], referencedIds: new Set() };
  }

  const { tokens, errors: lexErrors } = tokenize(input);
  const { ast, errors: parseErrors } = parse(tokens);

  const knownIds = new Set(criteria.map((c) => c.id));
  const referencedIds = new Set();
  const undefinedErrors = [];

  function walk(node) {
    if (node === null) return;
    if (node.type === "LETTER") {
      referencedIds.add(node.value);
      if (!knownIds.has(node.value)) {
        undefinedErrors.push({
          message: `Unknown criterion "${node.value}"`,
          pos: node.pos,
          len: node.value.length,
        });
      }
      return;
    }
    if (node.type === "GROUP") {
      walk(node.child);
      return;
    }
    if (node.type === "AND" || node.type === "OR") {
      walk(node.left);
      walk(node.right);
    }
  }
  walk(ast);

  return {
    ast,
    errors: [...lexErrors, ...parseErrors, ...undefinedErrors],
    referencedIds,
  };
}

export function unusedCriteriaIds(criteria, referencedIds) {
  return criteria.filter((c) => !referencedIds.has(c.id)).map((c) => c.id);
}
