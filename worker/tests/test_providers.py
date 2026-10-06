import unittest

from worker.providers import candidate_score, normalize, similarity


class ProviderScoringTests(unittest.TestCase):
    def test_normalizes_accents_and_punctuation(self):
        self.assertEqual(normalize("Léviathan: Wakes"), "leviathan wakes")

    def test_exact_metadata_beats_unrelated_metadata(self):
        exact, _ = candidate_score("Dune", "Frank Herbert", {"title": "Dune", "author": "Frank Herbert"})
        unrelated, _ = candidate_score("Dune", "Frank Herbert", {"title": "Foundation", "author": "Isaac Asimov"})
        self.assertGreater(exact, unrelated)

    def test_similarity_is_bounded(self):
        self.assertGreaterEqual(similarity("Dune", "Dune"), 0)
        self.assertLessEqual(similarity("Dune", "Dune"), 1)


if __name__ == "__main__":
    unittest.main()
