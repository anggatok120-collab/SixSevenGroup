const list = (s, def) => String(s || def).split(',').map((x) => x.trim()).filter(Boolean);

function loadConfig(env = process.env) {
  return {
    groupJid: env.GROUP_JID || '',
    admins: list(env.ADMIN_NUMBERS, '').map((n) => n.replace(/\D/g, '')),
    dailyAt: env.DAILY_SUMMARY_AT || '06:00',
    classLeadMin: Number(env.CLASS_REMINDER_MIN || 30),
    taskLeadsMin: list(env.TASK_REMINDERS_MIN, '4320,1440,180').map(Number),
    examLeadsMin: list(env.EXAM_REMINDERS_MIN, '10080,1440').map(Number),
    examMorningAt: env.EXAM_MORNING_AT || '06:00',
  };
}

module.exports = { loadConfig };
