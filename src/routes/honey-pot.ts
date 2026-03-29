import express from 'express';
import {getHoneypotStatus} from '../controllers/honey-pot';

const router = express.Router();

router.get('/', getHoneypotStatus);

export default router;
