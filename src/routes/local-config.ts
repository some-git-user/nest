import express from 'express';
import {getLocalConfig, postLocalConfig} from '../controllers/local-config';

const router = express.Router();

router.get('/', getLocalConfig);
router.post('/', postLocalConfig);

export default router;
