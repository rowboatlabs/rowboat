'use client';
import { Input, Select, SelectItem, Textarea } from "@nextui-org/react"
import { useState } from "react";
import { createDataSource, addDocsToDataSource } from "../../../../actions/datasource_actions";
import { FormStatusButton } from "../../../../lib/components/form-status-button";
import { DataSourceIcon } from "../../../../lib/components/datasource-icon";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

export function Form({
    projectId
}: {
    projectId: string;
}) {
    const [sourceType, setSourceType] = useState("");
    const router = useRouter();

    // async function createCrawlDataSource(formData: FormData) {
    //     const source = await createDataSource({
    //         projectId,
    //         name: formData.get('name') as string,
    //         data: {
    //             type: 'crawl',
    //             startUrl: formData.get('startUrl') as string,
    //             limit: parseInt(formData.get('limit') as string),
    //         },
    //         status: 'queued',
    //     });
    //     router.push(`/projects/${projectId}/sources/${source._id}`);
    // }

    async function createUrlsDataSource(formData: FormData) {
        const source = await createDataSource({
            projectId,
            name: formData.get('name') as string,
            data: {
                type: 'urls',
            },
            status: 'pending',
        });

        const urls = formData.get('urls') as string;
        const urlsArray = urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);
        // pick first 100
        const first100Urls = urlsArray.slice(0, 100);
        await addDocsToDataSource({
            projectId,
            sourceId: source._id,
            docData: first100Urls.map(url => ({
                name: url,
                data: {
                    type: 'url',
                    url,
                },
            })),
        });
        router.push(`/projects/${projectId}/sources/${source._id}`);
    }

    async function createFilesDataSource(formData: FormData) {
        const source = await createDataSource({
            projectId,
            name: formData.get('name') as string,
            data: {
                type: 'files',
            },
            status: 'ready',
        });

        router.push(`/projects/${projectId}/sources/${source._id}`);
    }

    function handleSourceTypeChange(event: React.ChangeEvent<HTMLSelectElement>) {
        setSourceType(event.target.value);
    }

    return <div className="grow overflow-auto py-4">
        <div className="max-w-[768px] mx-auto flex flex-col gap-4">
            <Select
                label="Select type"
                selectedKeys={[sourceType]}
                onChange={handleSourceTypeChange}
            >
                {/* <SelectItem
                    key="crawl"
                    value="crawl"
                    startContent={<DataSourceIcon type="crawl" />}
                >
                    Crawl URLs
                </SelectItem> */}
                <SelectItem
                    key="urls"
                    value="urls"
                    startContent={<DataSourceIcon type="urls" />}
                >
                    Scrape URLs
                </SelectItem>
                <SelectItem
                    key="files"
                    value="files"
                    startContent={<DataSourceIcon type="files" />}
                >
                    Upload files
                </SelectItem>
             </Select>

            {/* {sourceType === "crawl" && <form
                action={createCrawlDataSourceWithProjectId}
                className="flex flex-col gap-4"
            >
                <Input
                    required
                    type="text"
                    name="url"
                    label="Specify starting URL to crawl"
                    labelPlacement="outside"
                    placeholder="https://example.com"
                    variant="bordered"
                />
                <div className="self-start w-[200px]">
                    <Input
                        required
                        type="number"
                        min={1}
                        max={5000}
                        name="limit"
                        label="Maximum pages to crawl"
                        labelPlacement="outside"
                        placeholder="100"
                        defaultValue={"100"}
                        variant="bordered"
                    />
                </div>
                <div className="self-start">
                    <Input
                        required
                        type="text"
                        name="name"
                        label="Name this data source"
                        labelPlacement="outside"
                        placeholder="e.g. Help articles"
                        variant="bordered"
                    />
                </div>
                <div className="text-sm">
                    <p>Note:</p>
                    <ul className="list-disc ml-4">
                        <li>Expect about 5-10 minutes to crawl 100 pages</li>
                    </ul>
                </div>
                <FormStatusButton
                    props={{
                        type: "submit",
                        children: "Add data source",
                        className: "self-start",
                        startContent: <svg className="w-[24px] h-[24px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M5 12h14m-7 7V5" />
                        </svg>,
                    }}
                />
            </form>} */}

            {sourceType === "urls" && <form
                action={createUrlsDataSource}
                className="flex flex-col gap-4"
            >
                <Textarea
                    required
                    type="text"
                    name="urls"
                    label="Specify URLs (one per line)"
                    minRows={5}
                    maxRows={10}
                    labelPlacement="outside"
                    placeholder="https://example.com"
                    variant="bordered"
                />
                <div className="self-start">
                    <Input
                        required
                        type="text"
                        name="name"
                        label="Name this data source"
                        labelPlacement="outside"
                        placeholder="e.g. Help articles"
                        variant="bordered"
                    />
                </div>
                <div className="text-sm">
                    <p>Note:</p>
                    <ul className="list-disc ml-4">
                        <li>Expect about 5-10 minutes to scrape 100 pages</li>
                        <li>Only the first 100 (valid) URLs will be scraped</li>
                    </ul>
                </div>
                <FormStatusButton
                    props={{
                        type: "submit",
                        children: "Add data source",
                        className: "self-start",
                        startContent: <PlusIcon className="w-[24px] h-[24px]" />
                    }}
                />
            </form>}

            {sourceType === "files" && <form
                action={createFilesDataSource}
                className="flex flex-col gap-4"
            >
                <div className="self-start">
                    <Input
                        required
                        type="text"
                        name="name"
                        label="Name this data source"
                        labelPlacement="outside"
                        placeholder="e.g. Documentation files"
                        variant="bordered"
                    />
                </div>
                <div className="text-sm">
                    <p>You will be able to upload files in the next step</p>
                </div>
                <FormStatusButton
                    props={{
                        type: "submit",
                        children: "Add data source",
                        className: "self-start",
                        startContent: <PlusIcon className="w-[24px] h-[24px]" />
                    }}
                />
            </form>}
        </div>
    </div>;
}