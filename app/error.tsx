"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="directory-main">
    <h1>Η σελίδα δεν μπόρεσε να φορτωθεί.</h1>
    <p>Τα δεδομένα δεν είναι διαθέσιμα αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.</p>
    <button type="button" onClick={reset}>Δοκίμασε ξανά</button>
  </main>;
}
