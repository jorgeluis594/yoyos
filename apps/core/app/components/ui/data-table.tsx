import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type TableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  mobile?: "title" | "value" | "description" | "actions";
};

type TableLayoutProps<T> = {
  columns: readonly TableColumn<T>[];
  caption: string;
  className?: string;
};

type TableContentProps<T> = TableLayoutProps<T> & {
  data: readonly T[];
  getRowId: (row: T) => string;
  getRowClassName?: (row: T) => string;
  emptyMessage?: React.ReactNode;
  isLoading?: boolean;
  skeletonRows?: number;
};

export type DataTableProps<T> = Omit<TableContentProps<T>, "data"> &
  (
    | { data: readonly T[]; loadData?: never }
    | { data?: never; loadData: Promise<readonly T[]> | (() => Promise<readonly T[]>) }
  );

const alignment = {
  left: "text-left",
  center: "text-center",
  right: "text-right tabular-nums",
};

function TableLayout<T>({
  columns,
  caption,
  children,
  className,
  isLoading = false,
}: TableLayoutProps<T> & { children: React.ReactNode; isLoading?: boolean }) {
  const hasMobileLayout = columns.some((column) => column.mobile);

  if (process.env.NODE_ENV !== "production" && hasMobileLayout) {
    const roles = columns.map((column) => column.mobile);
    if (
      roles.filter((role) => role === "title").length !== 1 ||
      roles.filter((role) => role === "value").length > 1 ||
      roles.filter((role) => role === "actions").length > 1
    ) {
      throw new Error(
        'DataTable mobile layout requires one "title" and at most one "value" and "actions" column.',
      );
    }
  }

  return (
    <div className="data-table-container min-w-0">
      <div
        className={cn("rounded-[var(--radius-card)] border bg-card text-card-foreground", className)}
        data-mobile-table={hasMobileLayout || undefined}
      >
        {isLoading && (
          <span role="status" className="sr-only">
            Cargando {caption}…
          </span>
        )}
        <Table role="table" aria-busy={isLoading}>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader role="rowgroup">
            <TableRow role="row">
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  scope="col"
                  role="columnheader"
                  data-mobile-role={column.mobile}
                  className={cn(
                    alignment[column.align ?? "left"],
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">{children}</TableBody>
        </Table>
      </div>
    </div>
  );
}

export function DataTableSkeleton<T>({
  columns,
  caption,
  className,
  rows = 5,
}: TableLayoutProps<T> & { rows?: number }) {
  return (
    <TableLayout
      columns={columns}
      caption={caption}
      className={className}
      isLoading
    >
      {Array.from({ length: rows }, (_, index) => (
        <TableRow key={index} role="row" aria-hidden="true">
          {columns.map((column) => (
            <TableCell
              key={column.id}
              role="cell"
              data-column={column.id}
              data-mobile-role={column.mobile}
              data-mobile-label={
                typeof column.header === "string" ? column.header : undefined
              }
              className={column.className}
            >
              <Skeleton className="h-5 w-full min-w-12" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableLayout>
  );
}

function TableContent<T>({
  data,
  columns,
  caption,
  getRowId,
  className,
  emptyMessage = "Sin resultados.",
  getRowClassName,
}: TableContentProps<T>) {
  return (
    <TableLayout columns={columns} caption={caption} className={className}>
      {data.length ? (
        data.map((row) => (
          <TableRow
            key={getRowId(row)}
            role="row"
            className={getRowClassName?.(row)}
          >
            {columns.map((column) => (
              <TableCell
                key={column.id}
                role="cell"
                data-column={column.id}
                data-mobile-role={column.mobile}
                data-mobile-label={
                  typeof column.header === "string" ? column.header : undefined
                }
                className={cn(
                  alignment[column.align ?? "left"],
                  column.className,
                )}
              >
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))
      ) : (
        <TableRow role="row" data-mobile-empty>
          <TableCell
            role="cell"
            colSpan={columns.length}
            className="h-32 text-center text-muted-foreground"
          >
            {emptyMessage}
          </TableCell>
        </TableRow>
      )}
    </TableLayout>
  );
}

function PendingTable<T>({
  promise,
  ...props
}: Omit<TableContentProps<T>, "data"> & { promise: Promise<readonly T[]> }) {
  const data = React.use(promise);
  return <TableContent {...props} data={data} />;
}

/** Pass a loader-created promise; keep queries and authorization in the route loader. */
export function DataTable<T>({
  data,
  loadData,
  isLoading,
  skeletonRows = 5,
  ...props
}: DataTableProps<T>) {
  const skeleton = <DataTableSkeleton {...props} rows={skeletonRows} />;
  if (isLoading) return skeleton;
  if (loadData) {
    // Read the promise below Suspense; retries reuse it instead of querying again.
    const promise = typeof loadData === "function" ? loadData() : loadData;
    return (
      <React.Suspense fallback={skeleton}>
        <PendingTable {...props} promise={promise} />
      </React.Suspense>
    );
  }
  return <TableContent {...props} data={data} />;
}
