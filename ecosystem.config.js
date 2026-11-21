module.exports = {
  apps: [{
    name: 'wa-pengingat-kuliah',
    script: 'src/index.js',
    max_memory_restart: '300M',
    restart_delay: 5000,
    env: { NODE_ENV: 'production' }
  }]
};
