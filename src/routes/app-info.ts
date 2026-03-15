import express from 'express';
import {getAppInfo} from '../controllers/app-info';

const router = express.Router();

router.get('/', getAppInfo);

export default router;
