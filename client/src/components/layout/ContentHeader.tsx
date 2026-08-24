import { Search, X } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { openPalette } from '@/lib/palette';

export interface Crumb {
  label: ReactNode;
  href?: string;
}

/** breadcrumb + actions row pinned to the top of the content scroll viewport */
export function ContentHeader({
  crumbs,
  actions,
  scrolled,
  showSidebarTrigger = true,
  onClose,
}: {
  crumbs: Crumb[];
  actions?: ReactNode;
  scrolled: boolean;
  showSidebarTrigger?: boolean;
  onClose?: () => void;
}) {
  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-10 flex min-h-9 items-center justify-between gap-4 border-b border-transparent bg-background/80 px-3 py-2 backdrop-blur-md transition-[border-color] duration-200 data-[scrolled=true]:border-border/40"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showSidebarTrigger && (
          <>
            <SidebarTrigger />
            <Separator
              orientation="vertical"
              className="mr-1 data-[orientation=vertical]:h-4"
            />
          </>
        )}
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((crumb, i) => (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate">
                      {crumb.label}
                    </BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Close side pane"
            aria-label="Close side pane"
            onClick={onClose}
          >
            <X />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 md:hidden"
          title="Search pages"
          onClick={openPalette}
        >
          <Search />
        </Button>
      </div>
    </header>
  );
}
