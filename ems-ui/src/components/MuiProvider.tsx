"use client";

import type { ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

/**
 * MUI theme tuned to the payroll-ui look the rest of the app uses: Exo font,
 * brand #3482ae, hairline borders, compact rows. globals.css uppercases all
 * text (`* { text-transform: uppercase }`), which the grid inherits — so it
 * reads consistently with the other tables; case-sensitive cells opt out with
 * `normal-case` in DataTable's renderCell.
 */
const theme = createTheme({
  typography: { fontFamily: "var(--font-exo), sans-serif", fontSize: 12 },
  palette: {
    primary: { main: "#3482ae" },
    text: { primary: "#212529", secondary: "#6b7280" },
    DataGrid: { bg: "#ffffff", headerBg: "#f4f6f9" },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: "1px solid #dee2e6",
          borderRadius: 8,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        },
        columnHeaderTitle: {
          fontWeight: 500,
          fontSize: "10.5px",
          letterSpacing: "0.02em",
        },
        cell: { fontSize: 11, borderColor: "#eceef1" },
      },
    },
    MuiTablePagination: { styleOverrides: { root: { fontSize: 11 } } },
  },
});

export default function MuiProvider({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </AppRouterCacheProvider>
  );
}
