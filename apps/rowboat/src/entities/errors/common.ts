export class BillingError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class QueryLimitError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class BadRequestError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class NotFoundError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class NotAuthorizedError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
    }
}