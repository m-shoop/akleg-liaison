export function indexToLetter(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`indexToLetter: index must be a non-negative integer, got ${index}`);
  }
  let n = index;
  let result = "";
  while (true) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return result;
}

export function letterToIndex(letter) {
  if (typeof letter !== "string" || !/^[A-Z]+$/.test(letter)) {
    throw new Error(`letterToIndex: invalid letter "${letter}"`);
  }
  let n = 0;
  for (let i = 0; i < letter.length; i++) {
    n = n * 26 + (letter.charCodeAt(i) - 64);
  }
  return n - 1;
}
