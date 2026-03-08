export default function GlobalLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    </div>
  );
}
