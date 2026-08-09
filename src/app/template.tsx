// Route-enter transition: every page rises 6px into place over 220ms
// (.route-enter, globals.css — reduced-motion turns it off). A template
// remounts on navigation, which is exactly the hook the animation needs;
// header, footer and the cart drawer live in the root layout above this,
// so chrome stays put while content glides.
//
// CSS-only on purpose: React's <ViewTransition> still requires a canary
// build, and a production shop doesn't ride canaries for a flourish.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter flex flex-1 flex-col">{children}</div>;
}
