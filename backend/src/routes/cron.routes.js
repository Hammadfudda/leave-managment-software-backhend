import { Router } from 'express';
import { purgeExpiredEmployees } from '../jobs/index.js';

const router = Router();

router.get('/purge', async (req, res) => {
  const authorization = req.headers.authorization || '';
  const expected = process.env.CRON_SECRET;

  if (!expected || authorization !== `Bearer ${expected}`) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized',
    });
  }

  try {
    const result = await purgeExpiredEmployees();
    return res.json({
      success: true,
      message: 'Scheduled purge completed.',
      data: result,
    });
  } catch (error) {
    console.error('Scheduled purge failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Scheduled purge failed.',
    });
  }
});

export default router;
