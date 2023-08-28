import { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';

interface ErrorTypes {
  message?: string;
  name?: string;
  code?: number;
  errors?: [{ message: string}];
  statusCode?: number;
  keyValue?: unknown[];
}

const errorHandler = (
    err: ErrorTypes,
    _req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
): void => {
    let error = { ...err };

    error.message = err.message;
    error.statusCode = err.statusCode;

    // Log to console for dev
    console.log('****', err);

    // Mongoose bad object id
    if (err.name === 'CastError') {
        const message = 'Resource not found';
        // here we set the error message and statusCode
        error = createError(404, message);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const message = `Duplicated field value entered - ${
            Object.keys(err.keyValue)[0]
        }`;
        // here we set the error message and statusCode
        error = createError(400, message);
    }

    // Mongoose validation required fields
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map((val) => val.message);
        // here we set the error message and statusCode
        error = createError(409, { message });
    }

    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Server Error',
    });
};

export default errorHandler;