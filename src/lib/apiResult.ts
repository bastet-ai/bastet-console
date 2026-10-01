export type ApiResult<T> = ({ success: true } & T) | { success: false; error?: string }
