import express from 'express';
import {getHoneypotStatus, triggerHoneypot} from '../controllers/honey-pot';

const router = express.Router();

router.get('/', getHoneypotStatus);
router.all('/trip', triggerHoneypot);

export default router;
