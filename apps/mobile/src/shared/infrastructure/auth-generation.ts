let current = 0;

export const authGeneration = {
  get: () => current,
  advance: () => ++current,
};
