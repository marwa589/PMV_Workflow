export function runInBackground(task: () => Promise<unknown> | void): void {
  void Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error("Background task failed:", error);
    });
}
