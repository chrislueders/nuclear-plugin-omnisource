export const withTimeout = <T>(ms: number, promise: Promise<T>): Promise<T> => {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Source timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timer]);
};
