import { useQuery } from "@tanstack/react-query";
import { sharedInstancesList } from "../lib/api";

export function useSharedInstances() {
  return useQuery({
    queryKey: ["shared-instances"],
    queryFn: sharedInstancesList,
  });
}
