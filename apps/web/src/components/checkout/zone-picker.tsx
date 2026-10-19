"use client";

import { groupedZones, zoneById, type ShippingZone } from "@sakura/contracts";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { FieldFrame } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { input, optionItem, optionList } from "@/lib/variants";

/* --------------------------------------------------------------------------
   The delivery-zone picker — one searchable list of every place the shop
   prices postage to, grouped the way people in Dhaka think about the city.

   A combobox rather than a native <select>: ~160 options is a long scroll in
   a phone's select sheet, and a customer looking for "Mirpur" should be able
   to type it — in Bangla or in English, whichever they reach for. Both names
   are matched and both are shown, so a typed "mirpur" finds মিরপুর.

   It follows the ARIA 1.2 combobox pattern: the text input owns focus, the
   list is referenced by aria-controls, and the highlighted option is conveyed
   with aria-activedescendant, so a screen reader announces it as it moves.
   -------------------------------------------------------------------------- */

export function ZonePicker({
  value,
  onChange,
  label,
  hint,
  error,
  placeholder,
}: {
  value: string;
  onChange: (zone: ShippingZone) => void;
  label: string;
  hint?: string;
  error?: string;
  placeholder?: string;
}) {
  const { t, i18n } = useTranslation();
  const listId = useId();
  const bangla = i18n.language === "bn";

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const primary = (zone: ShippingZone) => (bangla ? zone.nameBn : zone.name);
  const secondary = (zone: ShippingZone) => (bangla ? zone.name : zone.nameBn);

  /* Filtered groups, plus the same options flattened, since the keyboard
     moves through options and never lands on a group heading. */
  const { groups, flat } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (zone: ShippingZone) =>
      !needle ||
      zone.name.toLowerCase().includes(needle) ||
      zone.nameBn.includes(needle) ||
      zone.city.toLowerCase().includes(needle);

    const filtered = groupedZones()
      .map((group) => ({ ...group, zones: group.zones.filter(matches) }))
      .filter((group) => group.zones.length > 0);

    return { groups: filtered, flat: filtered.flatMap((group) => group.zones) };
  }, [query]);

  const chosen = zoneById(value);

  function choose(zone: ShippingZone) {
    onChange(zone);
    setQuery("");
    setOpen(false);
  }

  function move(next: number) {
    const clamped = Math.max(0, Math.min(flat.length - 1, next));
    setActive(clamped);
    listRef.current
      ?.querySelector(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else move(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(active - 1);
    } else if (event.key === "Enter") {
      // Never submit the checkout form from inside the picker.
      if (open) event.preventDefault();
      if (open && flat[active]) choose(flat[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  /* While closed the field shows the chosen zone; while open it shows what
     is being typed, so editing never fights with the selection. */
  const shown = open ? query : chosen ? primary(chosen) : "";
  const activeOption = open && flat[active] ? `${listId}-${flat[active].id}` : undefined;

  let index = -1;

  return (
    <FieldFrame label={label} hint={hint} error={error} className="sm:col-span-2">
      {({ id, describedBy }) => (
        <div className="relative">
          <input
            id={id}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeOption}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            placeholder={chosen ? primary(chosen) : placeholder}
            value={shown}
            className={input({ state: error ? "error" : chosen ? "filled" : "default" })}
            onFocus={() => {
              setOpen(true);
              setActive(0);
            }}
            onBlur={() => {
              setOpen(false);
              setQuery("");
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />

          {open ? (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              className={cn(
                optionList,
                "absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto",
              )}
            >
              {groups.length === 0 ? (
                <li className="text-muted px-2.5 py-2.5">{t("checkout.shipping.zoneNoMatch")}</li>
              ) : (
                groups.map((group) => (
                  <li key={group.group} role="presentation">
                    <p
                      aria-hidden
                      className="text-muted px-2.5 pt-2.5 pb-1 font-mono text-xs tracking-wide uppercase"
                    >
                      {t(`checkout.shipping.zoneGroups.${group.group}`)}
                    </p>
                    <ul role="group" aria-label={t(`checkout.shipping.zoneGroups.${group.group}`)}>
                      {group.zones.map((zone) => {
                        index += 1;
                        const position = index;

                        return (
                          <li
                            key={zone.id}
                            id={`${listId}-${zone.id}`}
                            role="option"
                            aria-selected={zone.id === value}
                            data-index={position}
                            /* mousedown, not click: the input's blur closes the
                               list before a click would ever land. */
                            onMouseDown={(event) => {
                              event.preventDefault();
                              choose(zone);
                            }}
                            onMouseEnter={() => setActive(position)}
                            className={cn(
                              optionItem({ selected: position === active }),
                              "flex cursor-pointer items-baseline justify-between gap-3",
                            )}
                          >
                            <span>{primary(zone)}</span>
                            <span className="text-muted text-sm">{secondary(zone)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      )}
    </FieldFrame>
  );
}
