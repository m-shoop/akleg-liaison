import { TOKEN } from "./lexer.js";

export function parse(tokens) {
  const errors = [];
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = (type) => {
    const t = tokens[pos];
    if (t.type === type) {
      pos++;
      return t;
    }
    return null;
  };

  function parseExpression() {
    let left = parseTerm();
    while (peek().type === TOKEN.OR) {
      const opTok = consume(TOKEN.OR);
      const right = parseTerm();
      if (right === null) {
        errors.push({
          message: "Missing operand after 'OR'",
          pos: opTok.pos + opTok.len,
          len: 0,
        });
        return left;
      }
      left = left === null ? right : { type: "OR", left, right, pos: opTok.pos };
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek().type === TOKEN.AND) {
      const opTok = consume(TOKEN.AND);
      const right = parseFactor();
      if (right === null) {
        errors.push({
          message: "Missing operand after 'AND'",
          pos: opTok.pos + opTok.len,
          len: 0,
        });
        return left;
      }
      left = left === null ? right : { type: "AND", left, right, pos: opTok.pos };
    }
    return left;
  }

  function parseFactor() {
    const t = peek();

    if (t.type === TOKEN.LETTER) {
      pos++;
      return { type: "LETTER", value: t.value, pos: t.pos };
    }

    if (t.type === TOKEN.LPAREN) {
      const lparen = consume(TOKEN.LPAREN);
      const inner = parseExpression();
      const rparen = consume(TOKEN.RPAREN);
      if (rparen === null) {
        errors.push({
          message: "Unmatched parenthesis",
          pos: lparen.pos,
          len: 1,
        });
        return inner === null ? null : { type: "GROUP", child: inner, pos: lparen.pos };
      }
      if (inner === null) {
        errors.push({
          message: "Empty parenthesis group",
          pos: lparen.pos,
          len: rparen.pos - lparen.pos + 1,
        });
        return null;
      }
      return { type: "GROUP", child: inner, pos: lparen.pos };
    }

    if (t.type === TOKEN.AND || t.type === TOKEN.OR) {
      errors.push({
        message: `Unexpected operator "${t.value}"`,
        pos: t.pos,
        len: t.len,
      });
      pos++;
      return parseFactor();
    }

    return null;
  }

  const ast = parseExpression();

  while (peek().type !== TOKEN.EOF) {
    const t = peek();
    if (t.type === TOKEN.LETTER) {
      errors.push({
        message: `Missing operator before "${t.value}"`,
        pos: t.pos,
        len: t.len,
      });
    } else if (t.type === TOKEN.RPAREN) {
      errors.push({
        message: "Unmatched closing parenthesis",
        pos: t.pos,
        len: 1,
      });
    } else {
      errors.push({
        message: `Unexpected token "${t.value}"`,
        pos: t.pos,
        len: t.len,
      });
    }
    pos++;
  }

  return { ast, errors };
}
