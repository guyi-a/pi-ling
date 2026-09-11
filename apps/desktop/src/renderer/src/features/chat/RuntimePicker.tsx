import type { RuntimeKind } from "@pi-ling/contracts";

import { Bot, ChevronDown, FlaskConical, LoaderCircle } from "lucide-react";

import { createPortal } from "react-dom";



import { useAnchoredMenu } from "./use-anchored-menu.js";



function runtimeIcon(runtime: RuntimeKind) {

  if (runtime === "dsh") return <FlaskConical />;

  if (runtime === "codex") return <FlaskConical />;

  return <Bot />;

}



function runtimeLabel(runtime: RuntimeKind): string {

  if (runtime === "dsh") return "DSH";

  if (runtime === "codex") return "Codex";

  return "Native";

}



export function RuntimePicker(props: {

  value: RuntimeKind;

  available: RuntimeKind[];

  disabled: boolean;

  open: boolean;

  onOpenChange: (open: boolean) => void;

  switching?: boolean;

  switchingTo?: RuntimeKind | null;

  onChange: (runtime: RuntimeKind) => void;

}) {

  const busy = Boolean(props.switching);

  const target = props.switchingTo ?? props.value;

  const label = busy

    ? `切换 ${runtimeLabel(target)}…`

    : runtimeLabel(props.value);

  const pickerDisabled = props.disabled || busy;

  const close = () => props.onOpenChange(false);

  const { position, rootRef, triggerRef, menuRef } = useAnchoredMenu(

    props.open,

    close,

  );



  const menu =

    props.open && position

      ? createPortal(

          <div

            ref={menuRef}

            className="composer-menu composer-menu-portal runtime-menu"

            role="menu"

            style={{

              left: `${position.left}px`,

              bottom: `${position.bottom}px`,

            }}

          >

            <button

              type="button"

              className={props.value === "native" ? "selected" : ""}

              disabled={busy}

              onClick={() => {

                close();

                props.onChange("native");

              }}

            >

              <Bot />

              <span>

                <strong>Native</strong>

                <small>pi-ling Coding Agent</small>

              </span>

            </button>

            <button

              type="button"

              disabled={busy || !props.available.includes("dsh")}

              title={
                props.available.includes("dsh")
                  ? undefined
                  : "在 .env 中设置 PI_LING_DSH_BIN 或 PI_LING_REPO_ROOT 后重启"
              }

              className={props.value === "dsh" ? "selected" : ""}

              onClick={() => {

                close();

                props.onChange("dsh");

              }}

            >

              <FlaskConical />

              <span>

                <strong>DeepSeek Harness</strong>

                <small>Experimental · ACP</small>

              </span>

            </button>

            <button

              type="button"

              disabled={busy || !props.available.includes("codex")}

              className={props.value === "codex" ? "selected" : ""}

              onClick={() => {

                close();

                props.onChange("codex");

              }}

            >

              <FlaskConical />

              <span>

                <strong>DeepSeek Codex</strong>

                <small>Experimental · Agent engine</small>

              </span>

            </button>

          </div>,

          document.body,

        )

      : null;



  return (

    <>

      <div

        ref={rootRef}

        className={`runtime-picker-wrap${props.open ? " is-open" : ""}${

          busy ? " is-switching" : ""

        }`}

      >

        <button

          ref={triggerRef}

          type="button"

          className="runtime-picker-trigger"

          aria-label="Runtime"

          aria-haspopup="menu"

          aria-expanded={props.open}

          aria-busy={busy}

          disabled={pickerDisabled}

          onClick={() => {

            if (!pickerDisabled) {

              props.onOpenChange(!props.open);

            }

          }}

        >

          {busy ? (

            <LoaderCircle className="runtime-switch-spinner" />

          ) : (

            runtimeIcon(target)

          )}

          {label}

          <ChevronDown />

        </button>

      </div>

      {menu}

    </>

  );

}

