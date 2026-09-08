/**
 * Immutable, prepend-only linked chain of strings - used in place of a Set
 * for per-state membership tracking in the railway and multimodal search
 * engines. Each state transition adds one (or a few) new members on top of
 * the parent state's chain; recording that as a single O(1) new node -
 * instead of copying every existing member into a brand-new Set on every
 * expansion - avoids allocation/hashing overhead that scales with how deep
 * the search has gone. `chainHas` still walks the chain (same asymptotic
 * membership-check cost as Set.has on a same-sized collection), but
 * extending the chain costs nothing until something actually needs to
 * enumerate it.
 */
export type StringChainNode = {
    value: string;
    parent: StringChainNode | null;
};

export function chainHas(node: StringChainNode | null, value: string): boolean {
    let current = node;
    while (current) {
        if (current.value === value) return true;
        current = current.parent;
    }
    return false;
}

export function chainWith(node: StringChainNode | null, value: string): StringChainNode {
    return { value, parent: node };
}

/**
 * Materializes the chain into an array in the order values were originally
 * appended (oldest first) - the order needed by anything that reads the
 * sequence back (e.g. a service-key path), not just membership.
 */
export function chainToArray(node: StringChainNode | null): string[] {
    const values: string[] = [];
    let current = node;
    while (current) {
        values.push(current.value);
        current = current.parent;
    }
    values.reverse();
    return values;
}

/**
 * Materializes the chain into a Set - only for the boundary where a chain
 * must be handed to code that expects a real Set (e.g. an existing function
 * signature outside the search loop); order is irrelevant for a Set.
 */
export function chainToSet(node: StringChainNode | null): Set<string> {
    const values = new Set<string>();
    let current = node;
    while (current) {
        values.add(current.value);
        current = current.parent;
    }
    return values;
}
