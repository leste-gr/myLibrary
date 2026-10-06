import unittest

from worker.isbn import canonical_isbn


class IsbnTests(unittest.TestCase):
    def test_accepts_valid_isbn13(self):
        self.assertEqual(canonical_isbn("978-0-345-50067-0"), "9780345500670")

    def test_converts_isbn10(self):
        self.assertEqual(canonical_isbn("0-306-40615-2"), "9780306406157")

    def test_rejects_invalid_checksum(self):
        self.assertIsNone(canonical_isbn("9780345500671"))


if __name__ == "__main__":
    unittest.main()
