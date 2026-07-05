import { useQuery } from "@tanstack/react-query";
import { accessiblePrincipalsList } from "../lib/api";

export function useAccessiblePrincipals() {
  return useQuery({
    queryKey: ["accessible-principals"],
    queryFn: accessiblePrincipalsList,
  });
}
