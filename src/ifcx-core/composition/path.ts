
export function GetHead(path: string)
{
    return path.split("/")[0];
}

export function GetTail(path: string)
{
    let parts = path.split("/");
    parts.shift();
    return parts.join("/");
}

/** Parent path (everything but the last segment). Empty string for a root path. */
export function GetParent(path: string)
{
    let i = path.lastIndexOf("/");
    return i < 0 ? "" : path.substring(0, i);
}

/**
 * Resolve a path reference relative to a base node path. A leading "/" makes the
 * reference absolute (the leading slash is stripped). Otherwise each "../"
 * ascends one segment from `base` and the remainder is appended. Used to resolve
 * Brep topology references such as "../Edge_3".
 */
export function ResolveRelative(base: string, ref: string): string
{
    if (ref.startsWith("/")) return ref.substring(1);
    let here = base;
    let parts = ref.split("/");
    let out: string[] = [];
    for (let part of parts)
    {
        if (part === "" || part === ".") continue;
        if (part === "..") { here = GetParent(here); continue; }
        out.push(part);
    }
    let prefix = here.length > 0 ? `${here}/` : "";
    return `${prefix}${out.join("/")}`;
}