module.exports = {
  extends: ["@commitlint/config-conventional"],
  ignores: [
    (message) => /^Merge (branch|pull request|remote-tracking branch) /m.test(message),
    (message) => /^Revert "/m.test(message),
  ],
};
