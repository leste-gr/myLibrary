import asyncio
import os
import unittest
from unittest.mock import Mock, patch

from worker import main


class WorkerRunTests(unittest.TestCase):
    def test_drain_processes_every_available_job_then_exits(self):
        client = Mock()
        pipeline = Mock()
        jobs = [{"id": "one"}, {"id": "two"}]
        with (
            patch.dict(os.environ, {"RUN_MODE": "drain"}),
            patch.object(main, "database", return_value=client),
            patch.object(main, "build_pipeline", return_value=pipeline) as build,
            patch.object(main, "claim_next", side_effect=[*jobs, None]),
            patch.object(main, "process") as process,
        ):
            asyncio.run(main.run())
        build.assert_called_once_with()
        self.assertEqual([call.args[2] for call in process.call_args_list], jobs)

    def test_empty_drain_does_not_initialize_ocr(self):
        with (
            patch.dict(os.environ, {"RUN_MODE": "drain"}),
            patch.object(main, "database", return_value=Mock()),
            patch.object(main, "claim_next", return_value=None),
            patch.object(main, "build_pipeline") as build,
        ):
            asyncio.run(main.run())
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
