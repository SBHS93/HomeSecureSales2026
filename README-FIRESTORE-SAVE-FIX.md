# Firestore Important Information Save Fix

Cloud Firestore does not accept an array directly containing other arrays. The sensor matrix previously used `rows: [[...], [...]]`, so Firestore rejected the entire Important Information save.

This build stores each sensor row as a map with `c0`, `c1`, and subsequent cell fields. The visual table is unchanged. Existing array-form data is converted automatically if encountered. Asset version: `20260918-5`.
