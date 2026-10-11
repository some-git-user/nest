import express from 'express';
import {unifiedCheck} from '../controllers/unified';

const router = express.Router();

router.get('/', unifiedCheck);
router.post('/', unifiedCheck);

export default router;
