const cron = require('node-cron');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { logAudit } = require('../middleware/auditLog');

function startPurgeJob() {
  const expression = process.env.PURGE_CRON_EXPRESSION || '0 2 * * *';
  const days = parseInt(process.env.PURGE_AFTER_DAYS || '90', 10);

  cron.schedule(expression, async () => {
    console.log(`[purge] Running purge job for employees inactive > ${days} days`);
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const employees = await Employee.find({
        status: 'inactive',
        updatedAt: { $lt: cutoff },
      });

      let purged = 0;
      for (const emp of employees) {
        await User.findByIdAndDelete(emp.user);
        await Employee.findByIdAndDelete(emp._id);
        purged += 1;
      }

      if (purged > 0) {
        await logAudit({
          actor: null,
          actorRole: 'System',
          action: 'purge_employee',
          description: `Purged ${purged} inactive employees (inactive > ${days} days)`,
          metadata: { purged, cutoff },
        });
        console.log(`[purge] Purged ${purged} employees`);
      }
    } catch (err) {
      console.error('[purge] Error:', err.message);
    }
  });

  console.log(`[purge] Scheduled purge job: ${expression}`);
}

module.exports = startPurgeJob;
