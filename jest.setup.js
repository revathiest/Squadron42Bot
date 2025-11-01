const SUPPRESSED_ERROR_PATTERNS = [
  /moderation: failed to prune empty thread/
];

const originalInfo = console.info;
const originalError = console.error;

console.info = jest.fn();

console.error = (...args) => {
  const message = args[0];
  if (typeof message === 'string' && SUPPRESSED_ERROR_PATTERNS.some(pattern => pattern.test(message))) {
    return;
  }
  originalError.apply(console, args);
};

afterAll(() => {
  console.info = originalInfo;
  console.error = originalError;
});
