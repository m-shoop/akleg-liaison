import { indexToLetter } from "./expression/letterIds.js";

export function createInitialState({ seedRows = [] } = {}) {
  const criteria = seedRows.map((value, i) => ({ id: indexToLetter(i), value }));
  return {
    criteria,
    expression: "",
    nextLetterIndex: criteria.length,
  };
}

export function addRow(state, newValue) {
  const id = indexToLetter(state.nextLetterIndex);
  return {
    ...state,
    criteria: [...state.criteria, { id, value: newValue }],
    nextLetterIndex: state.nextLetterIndex + 1,
  };
}

export function removeRow(state, id) {
  return {
    ...state,
    criteria: state.criteria.filter((c) => c.id !== id),
  };
}

export function updateRowValue(state, id, value) {
  return {
    ...state,
    criteria: state.criteria.map((c) => (c.id === id ? { ...c, value } : c)),
  };
}

export function setExpression(state, expression) {
  return { ...state, expression };
}
