module.exports = {
  apps: [
    {
      name: "bot",
      script: "./dist/index.js",
    },
    {
      name: "cron",
      script: "./dist/cron.js",
    },
  ],
};
