import { tokenize, TOKEN } from "./lexer.js";

const TERMINAL_LEFT = new Set([TOKEN.LETTER, TOKEN.RPAREN]);
const TERMINAL_RIGHT = new Set([TOKEN.LETTER, TOKEN.LPAREN]);
const OPERATOR = new Set([TOKEN.AND, TOKEN.OR]);

function caretContext(expr, caretStart, caretEnd) {
  const { tokens } = tokenize(expr);
  const real = tokens.filter((t) => t.type !== TOKEN.EOF);

  let containingToken = null;
  for (const t of real) {
    const tEnd = t.pos + t.len;
    if (t.pos < caretStart && caretStart < tEnd) {
      containingToken = t;
      break;
    }
  }

  const snappedStart = containingToken ? containingToken.pos + containingToken.len : caretStart;
  const snappedEnd = containingToken ? Math.max(caretEnd, snappedStart) : caretEnd;

  let leftToken = null;
  let rightToken = null;
  for (const t of real) {
    if (t.pos + t.len <= snappedStart) leftToken = t;
    if (t.pos >= snappedEnd && rightToken === null) rightToken = t;
  }
  return { leftToken, rightToken, snappedStart, snappedEnd };
}

function buildSegment(left, middle, right) {
  const leftPart = left + (left ? " " : "");
  const rightPart = (right ? " " : "") + right;
  return {
    expression: leftPart + middle + rightPart,
    caret: leftPart.length + middle.length,
  };
}

export function insertLetter(expr, caretStart, caretEnd, letter) {
  const ctx = caretContext(expr, caretStart, caretEnd);
  const before = expr.slice(0, ctx.snappedStart).trimEnd();
  const after = expr.slice(ctx.snappedEnd).trimStart();

  const needLeftAnd = ctx.leftToken && TERMINAL_LEFT.has(ctx.leftToken.type);
  const needRightAnd = ctx.rightToken && TERMINAL_RIGHT.has(ctx.rightToken.type);

  const left = before + (needLeftAnd ? (before ? " AND" : "AND") : "");
  const right = (needRightAnd ? ("AND" + (after ? " " : "")) : "") + after;

  return buildSegment(left, letter, right);
}

export function insertOperator(expr, caretStart, caretEnd, op) {
  if (op !== "AND" && op !== "OR") {
    throw new Error(`insertOperator: op must be "AND" or "OR", got "${op}"`);
  }

  const ctx = caretContext(expr, caretStart, caretEnd);

  if (ctx.leftToken && OPERATOR.has(ctx.leftToken.type)) {
    const before = expr.slice(0, ctx.leftToken.pos).trimEnd();
    const after = expr.slice(ctx.leftToken.pos + ctx.leftToken.len).trimStart();
    return buildSegment(before, op, after);
  }
  if (ctx.rightToken && OPERATOR.has(ctx.rightToken.type)) {
    const before = expr.slice(0, ctx.rightToken.pos).trimEnd();
    const after = expr.slice(ctx.rightToken.pos + ctx.rightToken.len).trimStart();
    return buildSegment(before, op, after);
  }

  const before = expr.slice(0, ctx.snappedStart).trimEnd();
  const after = expr.slice(ctx.snappedEnd).trimStart();
  return buildSegment(before, op, after);
}
