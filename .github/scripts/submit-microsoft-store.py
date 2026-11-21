#!/usr/bin/env python3
"""Submit one verified VidBee MSIX to Microsoft Store.

`msstore publish` copies the last published listing and sends it back unchanged.
The Store API rejects a short description longer than 500 characters, even when
that text is already published. This script continues an editable draft (or
creates one), shortens every short description that does not fit, attaches the
package, and commits the submission. It does not delete a submission.
"""

from __future__ import annotations

import argparse
import copy
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

STORE_HOST = "manage.devcenter.microsoft.com"
SHORT_DESCRIPTION_LIMIT = 500
EDITABLE_STATUS = "PendingCommit"
POLL_SECONDS = 30
POLL_ATTEMPTS = 40
TOP_LEVEL_FIELDS = {
    "id",
    "applicationcategory",
    "pricing",
    "visibility",
    "targetpublishmode",
    "targetpublishdate",
    "listings",
    "hardwarepreferences",
    "automaticbackupenabled",
    "caninstallonremovablemedia",
    "isgamedvrenabled",
    "gamingoptions",
    "hasexternalinappproducts",
    "meetaccessibilityguidelines",
    "notesforcertification",
    "status",
    "statusdetails",
    "fileuploadurl",
    "applicationpackages",
    "packagedeliveryoptions",
    "enterpriselicensing",
    "allowmicrosoftdecideappavailabilitytofuturedevicefamilies",
    "allowtargetfuturedevicefamilies",
    "friendlyname",
    "trailers",
}


def field(obj: dict, name: str):
    """Return the value stored under a case-insensitive key."""
    key = field_name(obj, name)
    return None if key is None else obj[key]


def field_name(obj: dict, name: str) -> str | None:
    """Return the existing key that matches `name`, ignoring case."""
    for key in obj:
        if key.lower() == name.lower():
            return key
    return None


def trim_short_description(text: str) -> str:
    """Cut a short description at the last sentence that stays within the Store limit."""
    if len(text) <= SHORT_DESCRIPTION_LIMIT:
        return text
    window = text[:SHORT_DESCRIPTION_LIMIT]
    cut = -1
    for index, character in enumerate(window):
        if character in ".。！？!?" and index >= 40:
            cut = index
    if cut >= 40:
        return window[: cut + 1].strip()
    space = window.rfind(" ")
    if space >= 40:
        return window[:space].strip()
    return window.strip()


def trim_short_descriptions(node, path: str, changes: list[tuple[str, int, int]]) -> None:
    """Shorten every shortDescription field in a submission tree."""
    if isinstance(node, dict):
        for key, value in list(node.items()):
            child_path = f"{path}.{key}" if path else key
            if key.lower() == "shortdescription" and isinstance(value, str) and len(value) > SHORT_DESCRIPTION_LIMIT:
                trimmed = trim_short_description(value)
                node[key] = trimmed
                changes.append((child_path, len(value), len(trimmed)))
            else:
                trim_short_descriptions(value, child_path, changes)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            trim_short_descriptions(value, f"{path}[{index}]", changes)


def prepare_submission(submission: dict, package_name: str) -> tuple[dict, list[tuple[str, int, int]]]:
    """Return a submission body with a free price, the new package, and legal short descriptions."""
    source = copy.deepcopy(submission)
    body = {key: value for key, value in source.items() if key.lower() in TOP_LEVEL_FIELDS}
    changes: list[tuple[str, int, int]] = []
    trim_short_descriptions(body, "", changes)

    pricing_key = field_name(body, "Pricing") or "Pricing"
    pricing = body.get(pricing_key)
    if not isinstance(pricing, dict):
        pricing = {}
        body[pricing_key] = pricing
    price_key = field_name(pricing, "PriceId") or "PriceId"
    pricing[price_key] = "Free"

    packages_key = field_name(body, "ApplicationPackages") or "ApplicationPackages"
    packages = body.get(packages_key)
    if not isinstance(packages, list):
        packages = []
    updated_packages = []
    for package in packages:
        if not isinstance(package, dict):
            updated_packages.append(package)
            continue
        filename = field(package, "FileName") or ""
        if not str(filename).lower().endswith(".msix"):
            updated_packages.append(package)
            continue
        status = str(field(package, "FileStatus") or "")
        if status.lower() == "pendingupload":
            continue
        status_key = field_name(package, "FileStatus") or "FileStatus"
        package[status_key] = "PendingDelete"
        updated_packages.append(package)
    updated_packages.append({"FileName": package_name, "FileStatus": "PendingUpload"})
    body[packages_key] = updated_packages
    return body, changes


def require_env(name: str) -> str:
    """Read a required Store credential without printing it."""
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing GitHub Actions secret: {name}")
    return value


def request_json(method: str, url: str, token: str, tenant_id: str, payload: dict | None = None) -> dict:
    """Call the Store submission API and return its JSON object."""
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "TenantId": tenant_id,
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"Store API {method} {urllib.parse.urlparse(url).path} failed with HTTP {error.code}: {detail}") from error
    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Store API {method} returned an unexpected payload.")
    return parsed


def access_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    """Authenticate the CI application to Partner Center."""
    form = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://manage.devcenter.microsoft.com/.default",
            "grant_type": "client_credentials",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data=form,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Microsoft Entra authentication failed with HTTP {error.code}: {detail}") from error
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Microsoft Entra authentication did not return an access token.")
    return token


def upload_package(upload_url: str, zip_path: Path) -> None:
    """Upload the submission zip to the Store's SAS URL."""
    safe_url = upload_url.replace("+", "%2B")
    parsed = urllib.parse.urlparse(safe_url)
    connection = http.client.HTTPSConnection(parsed.netloc, timeout=1800)
    target = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    size = zip_path.stat().st_size
    try:
        with zip_path.open("rb") as handle:
            connection.request(
                "PUT",
                target,
                body=handle,
                headers={
                    "x-ms-blob-type": "BlockBlob",
                    "Content-Type": "application/zip",
                    "Content-Length": str(size),
                },
            )
            response = connection.getresponse()
            detail = response.read(500).decode("utf-8", errors="replace")
            if response.status not in (200, 201):
                raise RuntimeError(f"Package upload failed with HTTP {response.status}: {detail}")
    finally:
        connection.close()


def submission_url(app_id: str, submission_id: str | None = None, suffix: str = "") -> str:
    """Build a packaged-application submission URL."""
    root = f"https://{STORE_HOST}/v1.0/my/applications/{app_id}/submissions"
    if submission_id is None:
        return f"{root}?isMinimalResponse=true"
    return f"{root}/{submission_id}{suffix}"


def write_summary(message: str) -> None:
    """Append one line to the GitHub step summary when running in Actions."""
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    with open(summary, "a", encoding="utf-8") as handle:
        handle.write(message + "\n")


def submit(package_path: Path) -> None:
    """Commit `package_path` to the VidBee Store submission."""
    app_id = require_env("MSSTORE_APP_ID")
    tenant_id = require_env("MSSTORE_TENANT_ID")
    require_env("MSSTORE_SELLER_ID")
    token = access_token(tenant_id, require_env("MSSTORE_CLIENT_ID"), require_env("MSSTORE_CLIENT_SECRET"))
    app = request_json("GET", f"https://{STORE_HOST}/v1.0/my/applications/{app_id}", token, tenant_id)
    if field(app, "Id") != app_id or field(app, "PackageIdentityName") != "Nexmoe.VidBee":
        raise RuntimeError("The credentials resolved an unexpected Microsoft Store application.")
    if not field(field(app, "LastPublishedApplicationSubmission") or {}, "Id"):
        raise RuntimeError("Complete the first publication in Partner Center before enabling automatic updates.")

    pending = field(app, "PendingApplicationSubmission") or {}
    submission_id = field(pending, "Id") if isinstance(pending, dict) else None
    if submission_id:
        submission = request_json("GET", submission_url(app_id, str(submission_id)), token, tenant_id)
        status = str(field(submission, "Status") or "")
        if status.lower() != EDITABLE_STATUS.lower():
            raise RuntimeError(
                f"A Store submission is already {status or 'pending'}. Resolve it in Partner Center before retrying; it will not be deleted automatically."
            )
        if not field(submission, "FileUploadUrl"):
            raise RuntimeError(
                "The pending submission was created in Partner Center and cannot accept a CI package. Resolve it in Partner Center before retrying; it will not be deleted automatically."
            )
        print(f"Continuing editable Store draft {submission_id}.")
    else:
        created = request_json("POST", submission_url(app_id), token, tenant_id)
        submission_id = field(created, "Id")
        if not submission_id:
            raise RuntimeError("The Store did not return a new submission id.")
        print(f"Created Store submission {submission_id}.")
        submission = request_json("GET", submission_url(app_id, str(submission_id)), token, tenant_id)

    body, changes = prepare_submission(submission, package_path.name)
    if changes:
        for path, before, after in changes:
            print(f"Shortened {path} from {before} to {after} characters.")
    else:
        print("Store short descriptions are already within 500 characters.")

    zip_path = package_path.with_name(f"{package_path.stem}-store-upload.zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.write(package_path, package_path.name)

    updated = request_json("PUT", submission_url(app_id, str(submission_id)), token, tenant_id, body)
    upload_url = field(updated, "FileUploadUrl")
    if not isinstance(upload_url, str) or not upload_url:
        raise RuntimeError("The Store did not return a package upload URL.")
    upload_package(upload_url, zip_path)
    print("Uploaded the Store package.")

    request_json("POST", submission_url(app_id, str(submission_id), "/commit"), token, tenant_id)
    status = "CommitStarted"
    for _ in range(POLL_ATTEMPTS):
        time.sleep(POLL_SECONDS)
        report = request_json("GET", submission_url(app_id, str(submission_id), "/status"), token, tenant_id)
        status = str(field(report, "Status") or "")
        errors = field(field(report, "StatusDetails") or {}, "Errors") if isinstance(field(report, "StatusDetails"), dict) else None
        print(f"Submission status: {status}")
        if errors:
            raise RuntimeError(f"Store submission failed: {json.dumps(errors)[:2000]}")
        if status and status != "CommitStarted":
            break
    else:
        raise RuntimeError("Timed out waiting for the Store submission to leave CommitStarted.")
    if status == "CommitFailed":
        raise RuntimeError("Store submission commit failed. Check Partner Center before retrying.")
    message = (
        "Microsoft Store update submitted for certification. "
        "Publication follows Microsoft approval: "
        "https://partner.microsoft.com/dashboard/products/9MVHDX4ZBPHS/overview"
    )
    print(message)
    write_summary(message)


def self_test() -> None:
    """Check description trimming and package replacement without calling the Store."""
    long_text = ("Download videos and keep local transcripts. " * 20).strip()
    assert len(long_text) > SHORT_DESCRIPTION_LIMIT
    trimmed = trim_short_description(long_text)
    assert len(trimmed) <= SHORT_DESCRIPTION_LIMIT
    assert trimmed.endswith(".")
    assert trim_short_description("Already short enough.") == "Already short enough."

    submission = {
        "Id": "draft",
        "Status": "PendingCommit",
        "FileUploadUrl": "https://example.test/upload",
        "Pricing": {"PriceId": "Base"},
        "Listings": {
            "en-us": {
                "BaseListing": {"ShortDescription": long_text, "Description": "x" * 900},
                "PlatformOverrides": {"Windows.Desktop": {"ShortDescription": "y" * 600}},
            }
        },
        "ApplicationPackages": [
            {"FileName": "old-store.msix", "FileStatus": "Uploaded", "Id": "old"},
            {"FileName": "ignored.txt", "FileStatus": "Uploaded"},
            {"FileName": "partial.msix", "FileStatus": "PendingUpload"},
        ],
        "Unexpected": "drop-me",
    }
    original = copy.deepcopy(submission)
    body, changes = prepare_submission(submission, "VidBee-store.msix")
    assert submission == original
    assert "Unexpected" not in body
    assert body["Pricing"]["PriceId"] == "Free"
    assert body["Listings"]["en-us"]["BaseListing"]["Description"] == "x" * 900
    assert len(body["Listings"]["en-us"]["BaseListing"]["ShortDescription"]) <= SHORT_DESCRIPTION_LIMIT
    assert len(body["Listings"]["en-us"]["PlatformOverrides"]["Windows.Desktop"]["ShortDescription"]) <= SHORT_DESCRIPTION_LIMIT
    assert len(changes) == 2
    packages = body["ApplicationPackages"]
    assert packages[0]["FileStatus"] == "PendingDelete"
    assert packages[0]["Id"] == "old"
    assert packages[1]["FileName"] == "ignored.txt"
    assert packages[-1] == {"FileName": "VidBee-store.msix", "FileStatus": "PendingUpload"}
    assert not any(package.get("FileName") == "partial.msix" for package in packages)
    print("self-test ok")


def main() -> None:
    """Submit the package path passed on the command line."""
    parser = argparse.ArgumentParser()
    parser.add_argument("package", nargs="?", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.package is None or not args.package.is_file():
        raise RuntimeError("Expected the verified Microsoft Store MSIX path.")
    submit(args.package)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Microsoft Store submission failed: {error}", file=sys.stderr)
        sys.exit(1)
