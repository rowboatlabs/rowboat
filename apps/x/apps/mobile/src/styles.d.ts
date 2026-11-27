// 2026-11-17: the native app also typechecks its web CSS imports.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
declare module '*.css';
