import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { privacyGet, privacySet, type PrivacyChoices } from "../lib/api";

const KEY = ["privacy"];

/** The owner's two privacy switches (pekohub ADR-014). */
export function usePrivacy() {
  return useQuery({ queryKey: KEY, queryFn: privacyGet, staleTime: Infinity });
}

export function useSetPrivacy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (choices: PrivacyChoices) => privacySet(choices),
    onSuccess: (saved) => qc.setQueryData(KEY, saved),
  });
}
