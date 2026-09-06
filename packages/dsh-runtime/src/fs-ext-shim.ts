type Callback = (error: Error | null) => void;

export function flock(
  _fd: number,
  _flags: string,
  callback: Callback,
): void {
  callback(
    new Error(
      "fs-ext flock is unavailable on Windows; DSH must use its win32 lease path",
    ),
  );
}

export function flockSync(): never {
  throw new Error(
    "fs-ext flockSync is unavailable on Windows; DSH must use its win32 lease path",
  );
}
