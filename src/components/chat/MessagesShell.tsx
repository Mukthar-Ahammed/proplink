import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The two-pane chat inside the viewer's portal frame (`messages/layout.tsx`,
 * ADR-081): conversation list on the left, the open conversation on the right,
 * on the portal's plain white ground with hairline cards like every other
 * portal page. Phones show one pane at a time: the list on `/messages`, the
 * conversation on `/messages/[id]` (its header has a back arrow to the list).
 */
export function MessagesShell({
  list,
  children,
  conversationOpen,
}: {
  list: ReactNode;
  children: ReactNode;
  /** True on a conversation page: phones then hide the list. */
  conversationOpen: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-17rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_minmax(0,1fr)]">
      <div className={cn("min-h-0 min-w-0", conversationOpen && "hidden lg:block")}>
        {list}
      </div>
      <div className={cn("min-h-0 min-w-0", !conversationOpen && "hidden lg:block")}>
        {children}
      </div>
    </div>
  );
}
