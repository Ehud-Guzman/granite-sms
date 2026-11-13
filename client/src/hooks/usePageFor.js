import { useState } from "react";

/**
 * The page number for a list, going back to page 1 whenever `filterKey`
 * changes (a new search, another class, a different date range).
 * Returns [page, goTo].
 */
export default function usePageFor(filterKey) {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const goTo = (n) => {
    setState({ key: filterKey, page: n });
  };
  return [page, goTo];
}
