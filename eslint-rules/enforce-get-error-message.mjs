/**
 * Custom ESLint rule to enforce using shared getErrorMessage() function
 * instead of inline error instanceof Error checks for message extraction
 *
 * This rule ensures consistent error message handling across the codebase
 * by requiring use of the centralized getErrorMessage() from './error-message'
 *
 * Disallows simple error message extraction patterns like:
 *   error instanceof Error ? error.message : 'Unknown error'
 *   error instanceof Error ? error.message : String(error)
 *   error instanceof Error ? error.message : 'unexpected error'
 *
 * Allows complex error type checking for specific error properties:
 *   error instanceof Error && error.code === 'ENOENT'
 *   error instanceof Error ? error.message : error.cause
 *
 * Requires:
 *   import {getErrorMessage} from './error-message';
 *   const msg = getErrorMessage(error);
 */

export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Enforce use of shared getErrorMessage() function instead of inline error message extraction',
			recommended: true,
		},
		fixable: null,
		schema: [],
		messages: {
			avoidInlineErrorCheck:
				'Avoid inline "error instanceof Error" checks. Use the shared getErrorMessage() function from "./error-message" instead. Import it and call: getErrorMessage(error)',
			missingImport:
				'Missing getErrorMessage import. Add: import {getErrorMessage} from "./error-message"',
		},
	},
	create(context) {
		return {
			ConditionalExpression(node) {
				// Check for instanceof Error pattern in ternary
				if (node.test.type === 'BinaryExpression') {
					const test = node.test;
					if (
						test.operator === 'instanceof' &&
						test.left.type === 'Identifier' &&
						test.right.type === 'Identifier' &&
						test.right.name === 'Error'
					) {
						// Only flag if this is simple message extraction
						// Allow complex checks like: error instanceof Error && error.code === 'ENOENT'
						// or: error instanceof Error ? error.message : error.cause
						const errorVarName = test.left.name;

						// Check if consequent accesses .message property
						const isMessageAccess =
							node.consequent.type === 'MemberExpression' &&
							node.consequent.object.type === 'Identifier' &&
							node.consequent.object.name === errorVarName &&
							node.consequent.property.type === 'Identifier' &&
							node.consequent.property.name === 'message';

						// Check if alternate is a simple string literal or String() call
						const isSimpleAlternate =
							node.alternate.type === 'Literal' ||
							(node.alternate.type === 'CallExpression' &&
								node.alternate.callee.type === 'Identifier' &&
								node.alternate.callee.name === 'String');

						// Only report if it's a simple message extraction pattern
						if (isMessageAccess && isSimpleAlternate) {
							context.report({
								node: test,
								messageId: 'avoidInlineErrorCheck',
							});
						}
					}
				}
			},
		};
	},
};
