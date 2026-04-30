export const TOKEN = Object.freeze({
  LETTER: "LETTER",
  AND: "AND",
  OR: "OR",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  EOF: "EOF",
});

const LETTER_RE = /[A-Za-z]/;
const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

export function tokenize(input) {
  const tokens = [];
  const errors = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (WHITESPACE.has(ch)) {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: TOKEN.LPAREN, value: "(", pos: i, len: 1 });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: TOKEN.RPAREN, value: ")", pos: i, len: 1 });
      i++;
      continue;
    }

    if (LETTER_RE.test(ch)) {
      const start = i;
      let word = "";
      while (i < input.length && LETTER_RE.test(input[i])) {
        word += input[i].toUpperCase();
        i++;
      }
      const len = i - start;
      if (word === "AND") {
        tokens.push({ type: TOKEN.AND, value: "AND", pos: start, len });
      } else if (word === "OR") {
        tokens.push({ type: TOKEN.OR, value: "OR", pos: start, len });
      } else {
        tokens.push({ type: TOKEN.LETTER, value: word, pos: start, len });
      }
      continue;
    }

    errors.push({ message: `Unexpected character "${ch}"`, pos: i, len: 1 });
    i++;
  }

  tokens.push({ type: TOKEN.EOF, value: "", pos: input.length, len: 0 });
  return { tokens, errors };
}
