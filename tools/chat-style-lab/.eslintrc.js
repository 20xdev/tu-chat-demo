module.exports = {
  overrides: [
    {
      files: ['*.cjs'],
      env: { node: true, browser: false },
      rules: { 'no-console': 'off' },
    },
  ],
};
