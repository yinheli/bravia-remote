import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./src/web/app.tsx", "./src/web/app.css"],
  outdir: "./public",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
