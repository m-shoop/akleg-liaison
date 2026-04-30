const EMPTY_AND = Object.freeze({ logic: "AND", conditions: [], groups: [] });

function isEmptyGroup(group) {
  return (
    group === null ||
    group === undefined ||
    ((group.conditions?.length ?? 0) === 0 && (group.groups?.length ?? 0) === 0)
  );
}

export function compile(ast, criteria, compileRow) {
  const lookup = Object.fromEntries(criteria.map((c) => [c.id, c]));

  function compileLetter(letter) {
    const row = lookup[letter];
    if (!row) return null;
    const compiled = compileRow(row);
    return isEmptyGroup(compiled) ? null : compiled;
  }

  function compileNode(node) {
    if (node === null) return null;
    if (node.type === "LETTER") return compileLetter(node.value);
    if (node.type === "GROUP") return compileNode(node.child);
    if (node.type === "AND" || node.type === "OR") {
      const left = compileNode(node.left);
      const right = compileNode(node.right);
      const kids = [left, right].filter((g) => g !== null);
      if (kids.length === 0) return null;
      if (kids.length === 1) return kids[0];
      return { logic: node.type, conditions: [], groups: kids };
    }
    return null;
  }

  if (ast === null) {
    const groups = criteria
      .map((c) => compileRow(c))
      .filter((g) => !isEmptyGroup(g));
    if (groups.length === 0) return { ...EMPTY_AND };
    if (groups.length === 1) return groups[0];
    return { logic: "AND", conditions: [], groups };
  }

  const result = compileNode(ast);
  return result ?? { ...EMPTY_AND };
}
