import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus, FolderPlus, Loader2, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { pickSharedPath, principalAccess, principalSetAccess } from "../../lib/api";
import type { AccessPerson, AccessRule, PekoAccess } from "../../types";

/** The built-in tool that reads public web pages. */
const WEB_TOOL = "Fetch";

interface Draft {
  visitors: AccessRule;
  people: AccessPerson[];
}

function draftOf(access: PekoAccess): Draft {
  return { visitors: access.visitors, people: access.people };
}

/** How a person shows: their name, else the address without its kind. */
export function personLabel(person: { address: string; display_name?: string | null }): string {
  if (person.display_name) return person.display_name;
  return person.address.replace(/^(visitor|user|principal):(local:)?/, "");
}

/**
 * What other people reach when they talk to a local peko (runtime
 * ADR-113, its `ACCESS.toml`): files they read and change, public web
 * pages, connected services, and whether their requests for more come
 * to the owner. Everyone shares one set of rules; a person given their
 * own rules gets those instead.
 */
export default function SharingPanel({ name }: { name: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["principal-access", name],
    queryFn: () => principalAccess(name),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const save = useMutation({
    mutationFn: (d: Draft) => principalSetAccess(name, d.visitors, d.people),
    onSuccess: (next) => {
      queryClient.setQueryData(["principal-access", name], next);
      setDraft(draftOf(next));
      setSavedOnce(true);
    },
  });

  useEffect(() => {
    if (access.data && draft === null) setDraft(draftOf(access.data));
  }, [access.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useMemo(
    () =>
      !!access.data &&
      !!draft &&
      JSON.stringify(draft) !== JSON.stringify(draftOf(access.data)),
    [access.data, draft],
  );

  if (access.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("peko.sharing.loading")}
      </div>
    );
  }
  if (access.error) {
    return (
      <p className="text-[11px] text-danger" data-testid="sharing-error">
        {access.error instanceof Error ? access.error.message : String(access.error)}
      </p>
    );
  }
  if (!access.data || !draft) return null;
  const data = access.data;

  const update = (next: Draft) => {
    setSavedOnce(false);
    setDraft(next);
  };
  const others = data.known.filter((k) => !draft.people.some((p) => p.address === k.address));

  return (
    <section
      aria-labelledby="peko-sharing"
      className="rounded-xl border border-line bg-surface-raised p-3.5"
      data-testid="sharing-panel"
    >
      <h3 id="peko-sharing" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
        <Users className="h-3.5 w-3.5 text-fg-muted" />
        {t("peko.sharing.title")}
      </h3>
      <p className="mt-1 text-[11px] text-fg-muted">{t("peko.sharing.intro", { name })}</p>

      {data.problem ? (
        <p className="mt-2 text-[11px] text-danger" data-testid="sharing-problem">
          {t("peko.sharing.problem", { name, problem: data.problem })}
        </p>
      ) : (
        <>
          <div className="mt-3">
            <p className="text-xs font-medium text-fg">{t("peko.sharing.everyone")}</p>
            <p className="field-hint">{t("peko.sharing.everyoneHint")}</p>
            <RuleEditor
              id="everyone"
              name={name}
              rule={draft.visitors}
              servers={data.servers}
              workspace={data.workspace}
              onChange={(visitors) => update({ ...draft, visitors })}
            />
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium text-fg">{t("peko.sharing.people")}</p>
            <p className="field-hint">{t("peko.sharing.peopleHint")}</p>
            <ul className="mt-2 space-y-2">
              {draft.people.map((person, i) => (
                <li key={person.address} className="rounded-lg border border-line p-2.5" data-testid="sharing-person">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-fg">{personLabel(person)}</span>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() =>
                        update({ ...draft, people: draft.people.filter((_, j) => j !== i) })
                      }
                    >
                      {t("peko.sharing.removePerson")}
                    </button>
                  </div>
                  <RuleEditor
                    id={`person-${i}`}
                    name={name}
                    rule={person.rule}
                    servers={data.servers}
                    workspace={data.workspace}
                    onChange={(rule) =>
                      update({
                        ...draft,
                        people: draft.people.map((p, j) => (j === i ? { ...p, rule } : p)),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            {others.length > 0 ? (
              <select
                aria-label={t("peko.sharing.addPerson")}
                value=""
                onChange={(e) => {
                  const known = others.find((k) => k.address === e.target.value);
                  if (!known) return;
                  update({
                    ...draft,
                    people: [...draft.people, { ...known, rule: { ...draft.visitors } }],
                  });
                }}
                className="select input-sm mt-2 w-auto pr-7"
                data-testid="sharing-add-person"
              >
                <option value="">{t("peko.sharing.addPerson")}</option>
                {others.map((k) => (
                  <option key={k.address} value={k.address}>
                    {personLabel(k)}
                  </option>
                ))}
              </select>
            ) : (
              draft.people.length === 0 && (
                <p className="mt-1 text-[11px] text-fg-subtle">{t("peko.sharing.noOneYet", { name })}</p>
              )
            )}
          </div>

          <p className="mt-3 text-[11px] text-fg-subtle">{t("peko.sharing.own")}</p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!changed || save.isPending}
              onClick={() => save.mutate(draft)}
              data-testid="sharing-save"
            >
              {save.isPending ? t("common.saving") : t("common.save")}
            </button>
            {changed && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => update(draftOf(data))}>
                {t("peko.sharing.discard")}
              </button>
            )}
            {savedOnce && !changed && (
              <span className="text-[11px] text-fg-muted" data-testid="sharing-saved">
                {t("peko.sharing.saved")}
              </span>
            )}
          </div>
          {save.error && (
            <p className="mt-1 text-[11px] text-danger" data-testid="sharing-save-error">
              {save.error instanceof Error ? save.error.message : String(save.error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One set of rules: files, web pages, services, and asking for more. */
function RuleEditor({
  id,
  name,
  rule,
  servers,
  workspace,
  onChange,
}: {
  id: string;
  name: string;
  rule: AccessRule;
  servers: string[];
  workspace: string;
  onChange: (rule: AccessRule) => void;
}) {
  const { t } = useTranslation();
  const [outside, setOutside] = useState(false);

  async function add(list: "read" | "write", directory: boolean) {
    const picked = await pickSharedPath(workspace, directory);
    if (picked === null) return;
    if (picked === "outside") {
      setOutside(true);
      return;
    }
    setOutside(false);
    if (!rule[list].includes(picked)) onChange({ ...rule, [list]: [...rule[list], picked] });
  }

  const toggle = (list: "tools" | "mcp", item: string, on: boolean) =>
    onChange({
      ...rule,
      [list]: on ? [...rule[list], item] : rule[list].filter((x) => x !== item),
    });

  return (
    <div className="mt-2 space-y-3">
      {(["read", "write"] as const).map((list) => (
        <div key={list}>
          <p className="text-[11px] text-fg-muted">{t(`peko.sharing.${list}`)}</p>
          {rule[list].length === 0 ? (
            <p className="text-[11px] text-fg-subtle">{t("peko.sharing.none")}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {rule[list].map((path) => (
                <li
                  key={path}
                  className="flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg"
                >
                  {path}
                  <button
                    type="button"
                    aria-label={t("peko.sharing.remove", { path })}
                    onClick={() => onChange({ ...rule, [list]: rule[list].filter((p) => p !== path) })}
                    className="text-fg-subtle hover:text-fg"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => add(list, false)}
              data-testid={`sharing-${id}-${list}-file`}
            >
              <FilePlus className="h-3.5 w-3.5" /> {t("peko.sharing.addFile")}
            </button>
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => add(list, true)}
              data-testid={`sharing-${id}-${list}-folder`}
            >
              <FolderPlus className="h-3.5 w-3.5" /> {t("peko.sharing.addFolder")}
            </button>
          </div>
        </div>
      ))}
      {outside && <p className="text-[11px] text-danger">{t("peko.sharing.outside", { name })}</p>}

      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
          <input
            type="checkbox"
            checked={rule.tools.includes(WEB_TOOL)}
            onChange={(e) => toggle("tools", WEB_TOOL, e.target.checked)}
            className="h-3.5 w-3.5"
            data-testid={`sharing-${id}-web`}
          />
          {t("peko.sharing.web")}
        </label>
        {servers.map((server) => (
          <label key={server} className="flex cursor-pointer items-center gap-2 text-xs text-fg">
            <input
              type="checkbox"
              checked={rule.mcp.includes(server)}
              onChange={(e) => toggle("mcp", server, e.target.checked)}
              className="h-3.5 w-3.5"
              data-testid={`sharing-${id}-service-${server}`}
            />
            {t("peko.sharing.service", { server })}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor={`sharing-${id}-ask`} className="text-[11px] text-fg-muted">
          {t("peko.sharing.ask")}
        </label>
        <select
          id={`sharing-${id}-ask`}
          value={rule.ask_owner ? "ask" : "refuse"}
          onChange={(e) => onChange({ ...rule, ask_owner: e.target.value === "ask" })}
          className="select input-sm w-auto pr-7"
        >
          <option value="ask">{t("peko.sharing.askOwner")}</option>
          <option value="refuse">{t("peko.sharing.refuse", { name })}</option>
        </select>
      </div>
    </div>
  );
}
